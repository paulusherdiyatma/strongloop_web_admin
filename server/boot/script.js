/* global verificationToken */
module.exports = function (app) {
    var Member = app.models.Member;
    var Role = app.models.Role;
    var RoleMapping = app.models.RoleMapping;
    

RoleMapping.belongsTo(Member, {foreignKey: 'principalId'});
RoleMapping.belongsTo(Role, {foreignKey: 'roleId'});

    //create admin role, skip if already created
    Role.find({ name: 'admin' }, function (err, response) {
        if (response.length > 0) {
            console.log(response)
        }
        else {
            Role.create({
                name: 'admin'
            }, function (err, role) {
                if (err) throw err;

                Member.create({ username: 'admin', email: 'admin@admin.com', first_name: 'admin', password: 'password', emailVerified: true }, function (err, user) {
                    if (err) {
                        console.log("admin already created")
                    }
                    else {     
                        role.principals.create({
                            principalType:RoleMapping.USER,
                            principalId:user.id
                        }, function(err, principal){
                            
                        })
                    }
                });
            });

            Role.create({
                name: 'member'
            }, function (err, role) {
                Member.create({ username: 'member', email: 'member@member.com', first_name: 'member', password: 'password', emailVerified: true }, function (err, user) {
                    if (err) {
                        console.log("member already created")
                    }
                    else {
                        role.principals.create({
                            principalType:RoleMapping.USER,
                            principalId:user.id
                        }, function(err, principal){
                            
                        })
                    }
                });
            });
        }
    })
};