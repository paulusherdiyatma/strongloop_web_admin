module.exports = function (Member) {
    var loopback = require('../../node_modules/loopback/lib/loopback');
    var appRoot = require('../../server/server');
    
    //send verification email after registration
    Member.afterRemote('create', function (context, user, next) {
        //retrive role admin object
        appRoot.models.roleMember.find({ where: { name: 'member' } }, function (err, role) {
            var role_member = role[0];
            //create a new admin member
            appRoot.models.RoleMappingMember.create({ principalType: 'USER', principalId: user.id, roleId: role_member.id, memberId: user.id }, function (err, member) {
                var options = {
                    type: 'email',
                    to: user.email,
                    from: 'noreply@loopback.com',
                    subject: 'Thanks for registering.',
                    redirect: encodeURIComponent('/#/confirmation'),
                    user: user,
                };
                user.verify(options, function (err, response) {
                    if (err) return next(err);
                    next();
                });
            })
        })
    });
    
    //redirect to error page when confirm email is invalid
    Member.afterRemoteError('confirm', function (context, member, next) {
        Member.findById(context.req.query.uid, function (err, user) {
            if (user) {
                if (user.__data.emailVerified) {
                    context.res.redirect('/#/member-confirm-email-verified');
                    context.res.end();
                }
                else {
                    context.res.redirect('/#/member-confirm-error');
                    context.res.end();
                }
            }

            else {
                context.res.redirect('/#/member-confirm-error');
                context.res.end();
            }
        });
    })
    
    //redirect to success page when confirm email is success
    Member.afterRemote('confirm', function (context, member, next) {
        var Container = appRoot.models.container;
        Container.createContainer({ name: context.req.query.uid }, function (err, c) {
            next();
        });
    })
    
    //send error response when login proccess is failed
    Member.afterRemoteError('login', function (context, next) {
        delete context.error.stack;
        if (context.error.code == 'LOGIN_FAILED_EMAIL_NOT_VERIFIED') {
            context.error.message = "Please verify your email before login"
            context = context.error;
            next();
        }
        else {
            Member.find({ where: { email: context.req.body.email } }, function (err, user) {
                if (user.length == 0) {
                    context.error.message = "Login failed, " + context.req.body.email + " is not registered";
                }
                else {
                    context.error.message = "Login failed, please enter a valid password";
                }
                context = context.error;
                next();
            })
        }
    });

    Member.afterRemote('login', function (context, user, next) {
        Member.findById(context.result.__data.userId, { include: { relation: 'roleMapping', scope: { include: { relation: 'role' } } } }, function (err, member) {
            context.result.__data.first_name = member.first_name;
            context.result.__data.last_name = member.last_name;
            context.result.__data.dob = member.dob;
            context.result.__data.username = member.username;
            context.result.__data.role_name = member.__data.roleMapping[0].__data.role.name;
            next();
        })

    })
    
    //delete unused information on reset password response
    Member.afterRemoteError('resetPassword', function (context, next) {
        delete context.error.stack;
        context = context.error;
        next();
    });


    //check whether the request is from Admin or unauthenticated member.
    Member.beforeRemote('create', function (context, user, next) {
        context.req.body.created_date = new Date();
        if (typeof (context.req.body.username) == 'undefined' || context.req.body.username == '') {
            var error = new Error();
            error.name = 'BAD_REQUEST'
            error.status = 400;
            error.message = 'Username is empty';
            error.code = 'USERNAME_IS_EMPTY';
            return next(error)
        }
        else {

            Member.find({ where: { 'email': context.req.body.email } }, function (err, response) {
                if (response.length == 1) {
                    if (!response[0].emailVerified) {
                        var created_time = response[0].created_date.getTime();
                        var current_time = new Date().getTime();
                        var time_range_in_minutes = (current_time - created_time) / 60000;
                        if (time_range_in_minutes >= Member.app.settings.repeated_signup_interval) {
                            Member.destroyById(response[0].__data.id, function (err, res) {
                                appRoot.models.roleMappingMember.find({ where: { 'memberId': response[0].__data.id } }, function (err, role) {
                                    role.forEach(function (role_object) {
                                        role_object.remove();
                                    })
                                    next();
                                });
                            })
                        }

                        else {
                            var interval = (Math.round(Member.app.settings.repeated_signup_interval - time_range_in_minutes));
                            if (interval == 0) {
                                interval = 1;
                            }
                            var error = new Error();
                            error.name = '412'
                            error.status = 400;
                            error.message = 'Please sign up in next ' + interval + ' minutes';
                            error.code = 'RE_SIGNUP_ERROR';
                            return next(error)
                        }
                    }
                    else {
                        next();
                    }
                }
                else {
                    //define object model
                    var AccessToken = appRoot.models.AccessToken;
                    var RoleMember = appRoot.models.roleMember;
                    var RoleMapping = appRoot.models.RoleMappingMember;
        
                    //check whether access token is valid or not
                    AccessToken.findForRequest(context.req, {}, function (aux, accessToken) {
                        //request is from unauthenticated member
                        if (typeof (accessToken) == 'undefined') {
                            next();
                        }
            
                        //request is from authenticated member
                        else {
                            //retrive role admin object
                            RoleMember.find({ where: { name: 'admin' } }, function (err, role) {
                                var role_admin = role[0];

                                //check whether there is role mapping from memberId and role admin id
                                RoleMapping.find({ where: { memberId: context.req.accessToken.userId, roleId: role_admin.id } }, function (err, roleMapping) {
                                    //if the request from admin user
                                    if (roleMapping.length > 0) {
                                        var userRequest = context.req.body;
                                        userRequest.emailVerified = false;
                            
                                        //create a new admin member
                                        role_admin.members.create(userRequest, function (err, admin) {
                                            //error occured when create a new admin
                                            if (err) {
                                                var error = new Error();
                                                error.name = 'CONFLICT'
                                                error.status = 409;
                                                error.message = 'Email or Username already exist';
                                                error.code = 'EMAIL_USERNAME_EXIST';
                                                next(error)
                                            }
                                
                                            //successfully create a new admin
                                            else {
                                    
                                                //create a token
                                                var tokenGenerator = Member.generateVerificationToken;
                                                tokenGenerator(admin, function (err, token) {
                                                    if (err) { }
                                                    else {
                                                        admin.verificationToken = token;
                                                        admin.save(function (err) {
                                                        });
                                                    }
                                        
                                                    //add adminId and roleId into RoleMapping
                                                    RoleMapping.find({ where: { roleId: role.id, memberId: admin.id } }, function (err, roleMapping) {
                                                        roleMapping[0].principalType = RoleMapping.USER,
                                                        roleMapping[0].principalId = admin.id;
                                                        roleMapping[0].save(function (err) {
                                                            if (err) {

                                                            }
                                                            else {
                                                                return context.res.sendStatus(202);
                                                            }
                                                        });
                                                    })
                                                });
                                            }
                                        });
                                    }
                        
                                    //role mapping with adminId and roleId Admin not found
                                    else {
                                        next();
                                    }
                                })
                            })
                        }
                    },
                        function (error) {
                            console.log(error)
                        })
                }
            })
        }
    })

    //reset the user's pasword
    Member.beforeRemote('resetPassword', function (context, user, next) {
        if (context.req.body.password) {
            if (!context.req.headers.access_token) return context.res.sendStatus(401);
      
            //verify passwords match
            if (!context.req.body.password ||
                !context.req.body.password_confirmation ||
                context.req.body.password !== context.req.body.password_confirmation) {


                var error = new Error();
                error.name = 'BAD_REQUEST'
                error.status = 400;
                error.message = 'Passwords do not match';
                error.code = 'PASSWORDS_DO_NOT_MATCH';
                return next(error)
            }

            Member.findById(context.req.body.id, function (err, user) {
                if (err) return context.res.sendStatus(404);
                user.updateAttribute('password', context.req.body.password, function (err, user) {
                    if (err) return context.res.sendStatus(404);
                    console.log('> password reset processed successfully');
                    return context.res.sendStatus(202);
                });
            });

        }
        else {
            next();
        }

    });
    
    //find members
    Member.afterRemote('find', function (context, user, next) {
        var results = [];
        context.result.forEach(function (result) {
            Member.findById(result.__data.id, { include: { relation: 'roleMapping', scope: { include: { relation: 'role' } } } }, function (err, member) {
                result.__data.role_name = member.__data.roleMapping[0].__data.role.name;
                results.push(result);
                if (results.length == context.result.length) {
                    context.result = results;
                    next();
                }
            })


        })

    })
  
    //send password reset link when requested
    Member.on('resetPasswordRequest', function (info) {
        var host = (Member.app && Member.app.settings.host) || 'localhost';
        var port = (Member.app && Member.app.settings.port) || 3000;
        var url = host + ':' + port + '/#/reset-password';
        var html = 'Click <a href="http://' + url + '?password=' +
            info.user.password + '&token=' + info.accessToken.id + '&email=' + info.user.email + '&id=' + info.user.id + '">here</a> to reset your password';

        var options = {
            type: 'email',
            to: info.email,
            from: '',
            subject: 'Reset Password Request',
            html: html
        };

        var Email = options.mailer || this.constructor.email || loopback.getModelByType(loopback.Email);
        options.headers = options.headers || {};

        Email.send(options, function (err, email) {
            if (err) {
                console.log(err)
            } else {
                console.log("message sent")
            }
        });
    });
};





